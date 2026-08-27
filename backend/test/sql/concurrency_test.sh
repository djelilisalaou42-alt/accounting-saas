#!/bin/bash
# =====================================================================
# Test de concurrence réel : lance DEUX transactions PostgreSQL en
# parallèle qui appellent chacune fn_next_document_number() pour LA
# MÊME clé (même entreprise, même type de document, même portée) au
# même instant, avec un délai artificiel entre le SELECT ... FOR UPDATE
# et l'UPDATE pour maximiser la fenêtre de collision possible.
#
# Si le verrou de ligne fonctionne, la seconde transaction doit
# attendre que la première commit avant de pouvoir lire/incrémenter la
# séquence : les deux numéros obtenus doivent être différents et
# consécutifs.
# =====================================================================
set -euo pipefail

export PGPASSWORD=accounting_password
DB="accounting_saas_test"
COMPANY_ID="10000000-0000-0000-0000-000000000001"

# Session A : verrouille, attend 2s (simulateur de latence applicative), incrémente, commit
psql -h localhost -U accounting_user -d "$DB" -v ON_ERROR_STOP=1 <<SQL > /tmp/concurrency_A.log 2>&1 &
BEGIN;
SELECT fn_next_document_number('$COMPANY_ID', 'INVOICE', 'CONCURRENCY_TEST') AS number_a \gset
SELECT pg_sleep(2);
COMMIT;
\echo NUMERO_A: :number_a
SQL
PID_A=$!

# Session B : démarre 0.3s après A pour être sûre de tomber APRÈS le verrou de A,
# doit attendre le COMMIT de A avant de pouvoir avancer.
sleep 0.3
psql -h localhost -U accounting_user -d "$DB" -v ON_ERROR_STOP=1 <<SQL > /tmp/concurrency_B.log 2>&1 &
BEGIN;
SELECT fn_next_document_number('$COMPANY_ID', 'INVOICE', 'CONCURRENCY_TEST') AS number_b \gset
COMMIT;
\echo NUMERO_B: :number_b
SQL
PID_B=$!

wait $PID_A
wait $PID_B

echo "--- Session A ---"
cat /tmp/concurrency_A.log
echo "--- Session B ---"
cat /tmp/concurrency_B.log

NUM_A=$(grep -oP 'NUMERO_A: \K.*' /tmp/concurrency_A.log)
NUM_B=$(grep -oP 'NUMERO_B: \K.*' /tmp/concurrency_B.log)

if [ "$NUM_A" != "$NUM_B" ]; then
  echo "RESULTAT : PASS — numéros distincts obtenus sous concurrence (A=$NUM_A, B=$NUM_B)"
else
  echo "RESULTAT : FAIL — collision de numéro sous concurrence (A=$NUM_A, B=$NUM_B)"
fi
