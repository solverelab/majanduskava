const CORE_API = "http://api.solvere.ee:8000";

export async function evaluateMajanduskava(facts) {
  try {
    const response = await fetch(`${CORE_API}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "korteriühistu",
        jurisdiction: "EE",
        facts: facts,
      }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    console.error("Core API viga:", e);
    return null;
  }
}