import { MAIN_MEALS } from "../shared/pantry";

/** Today is over in the diary once breakfast, lunch and dinner are logged; until then it is an incomplete day. */
export async function isDayComplete(db: D1Database, date: string): Promise<boolean> {
  const { results } = await db.prepare("select distinct meal from diary_entries where date = ?").bind(date).all<{ meal: string }>();
  const meals = new Set(results.map((r) => r.meal));
  return MAIN_MEALS.every((m) => meals.has(m));
}
