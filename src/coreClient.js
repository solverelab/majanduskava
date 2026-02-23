const CORE_API = "https://solvere.ee";

export async function evaluateMajanduskava(facts, evaluationDate = null) {
  try {
    const today = evaluationDate || new Date().toISOString().split("T")[0];
    
    const payload = {
      evaluation_date: today,
      module: "korteriuhistu",
      facts: facts,
    };
    
    console.log("Solvere payload:", JSON.stringify(payload));
    
    const response = await fetch(`${CORE_API}/api/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error("Solvere viga:", err);
      return null;
    }
    return await response.json();
  } catch (e) {
    console.error("Core API viga:", e);
    return null;
  }
}