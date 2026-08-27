/**
 * Calcul du plan d'amortissement (Étape 12).
 *
 * Ancrage : le plan démarre TOUJOURS à l'année civile de la date de
 * mise en service (serviceDate), jamais à la date d'acquisition —
 * exigence explicite du cahier des charges ("l'amortissement ne doit
 * commencer qu'à partir de la date de mise en service"). Chaque
 * annuité couvre une année pleine, indexée par exercice civil
 * (fiscalYear = anneeMiseEnService + i - 1) ; aucune proratisation
 * journalière n'est appliquée (méthode simplifiée, cohérente avec le
 * reste du référentiel SYSCOHADA déjà en place dans ce projet).
 *
 * Dégressif : taux double constant (2 / duréeUtile) appliqué à la
 * valeur nette comptable restante, avec bascule vers le linéaire sur
 * la base et la durée restantes dès que celui-ci devient plus
 * favorable (montant plus élevé) — méthode dégressive simplifiée
 * décrite dans le cahier des charges.
 *
 * Arrondi : chaque annuité est arrondie au centime ; la DERNIÈRE
 * période absorbe systématiquement le reliquat d'arrondi, de sorte
 * que le cumul des dotations égale EXACTEMENT la base amortissable
 * (acquisitionCost - residualValue), quelle que soit la méthode.
 */

export interface DepreciationScheduleLine {
  /** Index d'annuité, 1-based (1 = première annuité, à l'année de mise en service). */
  period: number;
  /** Exercice civil couvert par cette annuité = anneeMiseEnService + period - 1. */
  fiscalYear: number;
  amount: number;
  accumulated: number;
  netBookValue: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeDepreciationSchedule(params: {
  acquisitionCost: number;
  residualValue: number;
  usefulLifeYears: number;
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';
  serviceDate: Date;
}): DepreciationScheduleLine[] {
  const { acquisitionCost, residualValue, usefulLifeYears, method, serviceDate } = params;
  const base = round2(acquisitionCost - residualValue);
  const serviceYear = serviceDate.getUTCFullYear();
  const schedule: DepreciationScheduleLine[] = [];

  if (base <= 0 || usefulLifeYears <= 0) return schedule;

  let cumulative = 0;

  if (method === 'STRAIGHT_LINE') {
    const annualAmount = round2(base / usefulLifeYears);
    for (let i = 1; i <= usefulLifeYears; i++) {
      const isLast = i === usefulLifeYears;
      const amount = isLast ? round2(base - cumulative) : annualAmount;
      cumulative = round2(cumulative + amount);
      schedule.push({
        period: i,
        fiscalYear: serviceYear + i - 1,
        amount,
        accumulated: cumulative,
        netBookValue: round2(acquisitionCost - cumulative),
      });
    }
    return schedule;
  }

  // DECLINING_BALANCE — taux double constant, bascule vers le linéaire
  // restant dès qu'il devient plus favorable.
  const rate = 2 / usefulLifeYears;
  let remainingBase = base;
  let remainingYears = usefulLifeYears;

  for (let i = 1; i <= usefulLifeYears; i++) {
    const isLast = i === usefulLifeYears;
    let amount: number;
    if (isLast) {
      amount = round2(base - cumulative);
    } else {
      const decliningAmount = remainingBase * rate;
      const straightLineRemaining = remainingBase / remainingYears;
      amount = round2(Math.max(decliningAmount, straightLineRemaining));
    }
    cumulative = round2(cumulative + amount);
    remainingBase = round2(remainingBase - amount);
    remainingYears -= 1;
    schedule.push({
      period: i,
      fiscalYear: serviceYear + i - 1,
      amount,
      accumulated: cumulative,
      netBookValue: round2(acquisitionCost - cumulative),
    });
  }
  return schedule;
}

/**
 * Retrouve l'annuité correspondant à un exercice civil donné.
 * L'index d'annuité N'EST JAMAIS l'exercice civil lui-même : il doit
 * être calculé comme (exercice_civil − année_de_mise_en_service + 1)
 * puis utilisé pour retrouver la ligne du plan (règle explicite du
 * cahier des charges, corrigée en cours de route à l'Étape 12).
 */
export function findScheduleLineForFiscalYear(
  schedule: DepreciationScheduleLine[],
  fiscalYear: number,
): DepreciationScheduleLine | undefined {
  return schedule.find((l) => l.fiscalYear === fiscalYear);
}
