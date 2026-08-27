-- =====================================================================
-- Seed additif — Étape 17 : permission d'export du journal d'audit.
-- AUDIT.READ existait déjà (placeholder Étape 5, déjà assigné à
-- SUPER_ADMIN/ADMIN/DIRECTOR/ACCOUNTANT/AUDITOR — vérifié, conservé
-- tel quel). Seule AUDIT.EXPORT est réellement nouvelle. Idempotent
-- (ON CONFLICT).
-- =====================================================================

BEGIN;

INSERT INTO permissions (id, code, module, description) VALUES
  (gen_random_uuid()::text, 'AUDIT.EXPORT', 'AUDIT', 'Exporter le journal d''audit filtré (CSV)')
ON CONFLICT (code) DO NOTHING;

-- Mêmes rôles que AUDIT.READ (déjà en place) — cohérent : qui peut
-- consulter le journal peut aussi l'exporter, sauf ACCOUNTANT qui
-- n'a pas vocation à produire des extractions d'audit pour un tiers
-- (seuls SUPER_ADMIN/ADMIN/DIRECTOR/AUDITOR obtiennent l'export).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.company_id IS NULL AND r.name IN ('SUPER_ADMIN', 'ADMIN', 'DIRECTOR', 'AUDITOR')
  AND p.code = 'AUDIT.EXPORT'
ON CONFLICT DO NOTHING;

COMMIT;
