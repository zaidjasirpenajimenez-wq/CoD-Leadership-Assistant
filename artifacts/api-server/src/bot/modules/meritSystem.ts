export interface MeritInput {
  totalPoints: number;
  eventsAttended: number;
  weeklyPoints: number;
  sanctions: number;
  kvkKills: number;
}

/** Returns an array of merit badge strings based on the player's stats */
export function computeMerits(data: MeritInput): string[] {
  const badges: string[] = [];

  if (data.totalPoints >= 1000) badges.push("👑 Leyenda");
  else if (data.totalPoints >= 500) badges.push("🏆 Élite");
  else if (data.totalPoints >= 200) badges.push("⭐ Veterano");

  if (data.eventsAttended >= 50) badges.push("🎖️ Centurión");
  else if (data.eventsAttended >= 20) badges.push("📅 Constante");
  else if (data.eventsAttended >= 10) badges.push("🗓️ Participativo");

  if (data.kvkKills >= 500) badges.push("💀 Exterminador");
  else if (data.kvkKills >= 100) badges.push("⚔️ Berserker");
  else if (data.kvkKills >= 50) badges.push("🗡️ Guerrero");

  if (data.sanctions === 0 && data.totalPoints > 0) badges.push("🛡️ Sin Faltas");

  if (data.weeklyPoints >= 100) badges.push("🔥 MVP Semanal");
  else if (data.weeklyPoints >= 50) badges.push("💪 Activo");

  return badges;
}
