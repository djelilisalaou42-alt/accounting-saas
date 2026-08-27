-- =====================================================================
-- Étape 17 — Journal d'audit consultable.
--
-- Inventaire préalable (voir schema.prisma) : AuditLog existait déjà en
-- intégralité depuis le schéma initial (Étape 2) — companyId, userId,
-- action, entityType/entityId, oldValue/newValue (JSON), ipAddress,
-- userAgent, createdAt, avec ses 4 index déjà en place (companyId,
-- userId, [entityType,entityId], createdAt). 18 services y écrivent
-- déjà. AUCUNE colonne ajoutée par cette étape — uniquement la
-- consultation manquait.
--
-- Seul ajout réel : un trigger d'immuabilité, appliquant au niveau
-- PostgreSQL — pas seulement par l'absence de bouton côté frontend —
-- la même garantie que trg_b_protect_validated_entries applique déjà
-- aux écritures comptables validées (Étape 7) : aucune ligne du
-- journal d'audit ne peut être modifiée ni supprimée, par AUCUN rôle
-- applicatif, y compris via un accès direct à la base. Cohérent avec
-- le principe déjà établi dans ce projet : les invariants critiques
-- sont protégés par trigger, jamais seulement par convention côté
-- application.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_protect_audit_log_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Le journal d''audit est immuable : suppression interdite (entrée %).', OLD.id;
  END IF;
  -- TG_OP = 'UPDATE'. Note : AuditLog.companyId utilise onDelete:
  -- SetNull dans schema.prisma pour l'hypothèse (jamais atteinte en
  -- pratique — aucune route DELETE /companies/:id n'existe dans ce
  -- projet) où une entreprise serait supprimée ; ce trigger bloque
  -- délibérément aussi ce cas, cohérent avec "trace historique
  -- immuable" — si cette hypothèse devait un jour se concrétiser, le
  -- trigger devra être révisé en conséquence.
  RAISE EXCEPTION 'Le journal d''audit est immuable : modification interdite (entrée %).', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_b_protect_audit_log_immutability
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_protect_audit_log_immutability();
