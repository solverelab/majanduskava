const CORE_API = "https://solvere.ee";

export async function evaluateMajanduskava(facts, evaluationDate = null) {
  try {
    const today = evaluationDate || new Date().toISOString().split("T")[0];
    
    const response = await fetch(`${CORE_API}/api/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evaluation_date: today,
        module: "korteriuhistu",
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