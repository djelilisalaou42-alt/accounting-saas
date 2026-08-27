import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAttachmentDto, ListAttachmentsDto } from './dto/attachment.dto';

export interface RequestMetadata {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * =====================================================================
 * ÉTAPE 16 — Pièces jointes.
 *
 * Modèle Attachment déjà existant depuis le schéma initial (Étape 2),
 * conçu avec des FK multiples nullables (un seul objet métier rattaché
 * par fichier) plutôt qu'un système polymorphe — CONSERVÉ TEL QUEL,
 * ajouter budget_id suit le même principe (voir README pour le détail
 * de cette décision d'architecture).
 *
 * Stockage : aucun système cloud (S3/MinIO) n'existe dans ce projet —
 * stockage sur disque local sous ATTACHMENTS_STORAGE_PATH, un
 * sous-dossier par entreprise, un nom de fichier interne généré
 * (UUID + extension whitelistée), JAMAIS le nom fourni par le client.
 * `fileUrl` (colonne existante) est réutilisé comme clé de stockage
 * interne relative — jamais une URL publique : aucune route statique
 * n'expose ce dossier, le téléchargement passe exclusivement par
 * `download()` ci-dessous, qui revérifie companyId/permission à chaque
 * appel (le guard de permissions vérifie déjà l'appartenance à
 * l'entreprise et le rôle, mais la vérification companyId === record
 * est reproduite ici en défense en profondeur).
 *
 * Sécurité upload : nom de fichier interne jamais dérivé du nom
 * client (élimine structurellement le path traversal), type MIME
 * restreint à une liste blanche, taille plafonnée
 * (ATTACHMENTS_MAX_SIZE_BYTES), hash SHA-256 calculé pour intégrité/
 * détection de doublon.
 * =====================================================================
 */

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.ms-excel': '.xls',
  'text/csv': '.csv',
  'text/plain': '.txt',
};

// Audit pré-production : le seul contrôle précédent portait sur
// `file.mimetype`, entièrement déclaré par le client (l'en-tête
// Content-Type de la partie multipart) — un exécutable renommé avec
// Content-Type: application/pdf passait sans détection. Vérification
// par signature binaire ("magic bytes") ajoutée ci-dessous pour les
// formats qui en possèdent une fiable — aucune dépendance ajoutée,
// plus petite couche nécessaire. CSV/texte n'ont pas de signature
// binaire fiable (n'importe quel contenu texte est un .txt/.csv
// valide) : ils restent contrôlés par MIME déclaré + extension
// uniquement, limitation documentée plutôt que masquée.
function matchesFileSignature(mimeType: string, buffer: Buffer): boolean {
  const b = buffer;
  switch (mimeType) {
    case 'application/pdf':
      return b.length >= 4 && b.subarray(0, 4).toString('ascii') === '%PDF';
    case 'image/jpeg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif':
      return b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a');
    case 'image/webp':
      return b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      // Formats Office modernes = archives ZIP (signature commune) —
      // confirme qu'il s'agit bien d'une archive ZIP, pas d'une
      // distinction plus fine entre .docx/.xlsx (tous deux partagent
      // cette signature ; limite acceptée, documentée).
      return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
    case 'application/msword':
    case 'application/vnd.ms-excel':
      // Formats Office legacy = conteneur OLE (signature commune aux
      // deux, même limite que ci-dessus).
      return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    case 'text/csv':
    case 'text/plain':
      // Aucune signature binaire fiable pour du texte brut — MIME
      // déclaré + extension restent les seuls contrôles pour ces deux
      // types, limitation assumée et documentée ci-dessus.
      return true;
    default:
      return false;
  }
}

const LINK_FIELDS = ['accountingEntryId', 'invoiceId', 'fixedAssetId', 'taxDeclarationId', 'budgetId'] as const;
type LinkField = (typeof LINK_FIELDS)[number];

@Injectable()
export class AttachmentsService {
  private readonly storageRoot: string;
  private readonly maxSizeBytes: number;

  constructor(private readonly prisma: PrismaService) {
    this.storageRoot = path.resolve(process.cwd(), process.env.ATTACHMENTS_STORAGE_PATH ?? './storage/attachments');
    this.maxSizeBytes = Number(process.env.ATTACHMENTS_MAX_SIZE_BYTES ?? 10 * 1024 * 1024);
  }

  async upload(companyId: string, userId: string, dto: CreateAttachmentDto, file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined, meta: RequestMetadata) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    if (file.size <= 0) throw new BadRequestException('Fichier vide.');
    if (file.size > this.maxSizeBytes) {
      throw new BadRequestException(`Fichier trop volumineux (${file.size} octets, maximum ${this.maxSizeBytes} octets).`);
    }
    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(`Type de fichier non autorisé : ${file.mimetype}.`);
    }
    if (!matchesFileSignature(file.mimetype, file.buffer)) {
      throw new BadRequestException("Le contenu du fichier ne correspond pas au type déclaré (signature binaire invalide).");
    }

    const providedLinks = LINK_FIELDS.filter((f) => dto[f]);
    if (providedLinks.length > 1) {
      throw new BadRequestException('Une pièce jointe ne peut être rattachée qu\'à un seul objet métier à la fois.');
    }
    if (providedLinks.length === 1) {
      await this.validateLinkBelongsToCompany(companyId, providedLinks[0], dto[providedLinks[0]]!);
    }

    // Nom de fichier interne — JAMAIS dérivé du nom fourni par le
    // client : élimine structurellement le path traversal et
    // l'écrasement arbitraire, quel que soit le nom envoyé.
    const internalName = `${randomUUID()}${extension}`;
    const relativePath = path.join(companyId, internalName);
    const absolutePath = path.join(this.storageRoot, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // Nom original conservé pour affichage uniquement — jamais utilisé
    // pour construire un chemin sur disque, tronqué et nettoyé des
    // caractères de contrôle par prudence.
    const safeOriginalName = file.originalname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'fichier';

    const attachment = await this.prisma.attachment.create({
      data: {
        companyId,
        fileName: safeOriginalName,
        fileUrl: relativePath,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        sha256,
        description: dto.description,
        category: dto.category,
        uploadedById: userId,
        accountingEntryId: dto.accountingEntryId,
        invoiceId: dto.invoiceId,
        fixedAssetId: dto.fixedAssetId,
        taxDeclarationId: dto.taxDeclarationId,
        budgetId: dto.budgetId,
      },
    });

    await this.audit('CREATE', userId, companyId, 'Attachment', attachment.id, null, { fileName: safeOriginalName }, meta);
    return attachment;
  }

  async list(companyId: string, filters: ListAttachmentsDto) {
    const where: any = { companyId };
    if (filters.entityType && filters.entityId) {
      const fieldMap: Record<string, string> = {
        accountingEntry: 'accountingEntryId',
        invoice: 'invoiceId',
        fixedAsset: 'fixedAssetId',
        taxDeclaration: 'taxDeclarationId',
        budget: 'budgetId',
      };
      where[fieldMap[filters.entityType]] = filters.entityId;
    }
    if (filters.category) where.category = filters.category;

    return this.prisma.attachment.findMany({
      where,
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    return this.getOrThrow(companyId, id, { uploadedBy: { select: { firstName: true, lastName: true } } });
  }

  /** Retourne les octets du fichier + métadonnées nécessaires pour la réponse HTTP. */
  async download(companyId: string, id: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const attachment = await this.getOrThrow(companyId, id);
    // Défense en profondeur : le guard de permissions a déjà vérifié
    // l'appartenance de l'utilisateur à companyId, mais on revérifie
    // ici explicitement que l'enregistrement appartient bien à
    // l'entreprise de la route avant de toucher le disque.
    if (attachment.companyId !== companyId) throw new ForbiddenException('Accès refusé.');

    const absolutePath = path.join(this.storageRoot, attachment.fileUrl);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(absolutePath);
    } catch {
      throw new NotFoundException('Le fichier est introuvable sur le stockage (métadonnées orphelines).');
    }
    return { buffer, fileName: attachment.fileName, mimeType: attachment.mimeType };
  }

  /** Suppression réelle — supprime la ligne ET le fichier physique (pas de suppression logique, aucun précédent de soft delete dans ce projet). */
  async remove(companyId: string, id: string, userId: string, meta: RequestMetadata): Promise<void> {
    const attachment = await this.getOrThrow(companyId, id);
    const absolutePath = path.join(this.storageRoot, attachment.fileUrl);

    await this.prisma.attachment.delete({ where: { id } });
    try {
      await fs.unlink(absolutePath);
    } catch {
      // Fichier déjà absent du disque — la suppression de
      // l'enregistrement reste l'opération qui fait autorité.
    }
    await this.audit('DELETE', userId, companyId, 'Attachment', id, { fileName: attachment.fileName }, null, meta);
  }

  // =====================================================================
  // UTILITAIRES
  // =====================================================================

  private async validateLinkBelongsToCompany(companyId: string, field: LinkField, entityId: string): Promise<void> {
    const checks: Record<LinkField, () => Promise<{ companyId: string } | null>> = {
      accountingEntryId: () => this.prisma.accountingEntry.findUnique({ where: { id: entityId }, select: { companyId: true } }),
      invoiceId: () => this.prisma.invoice.findUnique({ where: { id: entityId }, select: { companyId: true } }),
      fixedAssetId: () => this.prisma.fixedAsset.findUnique({ where: { id: entityId }, select: { companyId: true } }),
      taxDeclarationId: () => this.prisma.taxDeclaration.findUnique({ where: { id: entityId }, select: { companyId: true } }),
      budgetId: () => this.prisma.budget.findUnique({ where: { id: entityId }, select: { companyId: true } }),
    };
    const entity = await checks[field]();
    if (!entity || entity.companyId !== companyId) {
      throw new BadRequestException("L'objet auquel vous tentez de rattacher cette pièce jointe est introuvable pour cette entreprise.");
    }
  }

  private async getOrThrow(companyId: string, id: string, include?: any) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id }, include });
    if (!attachment || attachment.companyId !== companyId) throw new NotFoundException('Pièce jointe introuvable pour cette entreprise.');
    return attachment;
  }

  private async audit(action: string, userId: string, companyId: string, entityType: string, entityId: string, oldValue: unknown, newValue: unknown, meta: RequestMetadata): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { userId, companyId, action: action as any, entityType, entityId, oldValue: oldValue as any, newValue: newValue as any, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      });
    } catch {
      // best-effort
    }
  }
}
