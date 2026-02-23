import yaml
import uuid
from datetime import datetime
from fastapi import FastAPI, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from simpleeval import simple_eval

# --- UUDIS: SQLAlchemy andmebaasi impordid ---
from sqlalchemy import create_engine, Column, String, Boolean, DateTime
from sqlalchemy import JSON # Või lihtsalt sqlalchemy.JSON, kui kasutad SQLite
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# 1. ANDMEBAASI SEADISTUS (PostgreSQL näide)
# Kui sul pole Postgresi, kasuta: SQLALCHEMY_DATABASE_URL = "sqlite:///./solvere.db"
# ja asenda JSONB allpool tavalise JSON-iga.
SQLALCHEMY_DATABASE_URL = "sqlite:///./solvere.db"

db_engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
Base = declarative_base()

# Andmebaasi tabeli definitsioon
class EvaluationLog(Base):
    __tablename__ = "evaluation_logs"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    evaluated_at = Column(DateTime, default=datetime.utcnow)
    is_valid = Column(Boolean)
    request_payload = Column(JSON)  # Kogu sisend (faktid)
    response_payload = Column(JSON) # Kogu väljund (otsus + vead)

# Loome tabelid andmebaasi, kui neid veel pole
Base.metadata.create_all(bind=db_engine)

# Andmebaasi sessiooni haldaja FastAPI jaoks
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# 2. API ANDMEMUDELID (Leping - sama mis enne)
class MajanduskavaFacts(BaseModel):
    total_expected_annual_costs: float
    planned_reserve_capital: float
    previous_year_total_costs: float
    existing_loans: float
    new_loan_amount: float

class EvaluateRequest(BaseModel):
    evaluation_date: str
    facts: MajanduskavaFacts


# 3. SOLVERE MOOTOR (Sama mis enne)
class SolvereEngine:
    def __init__(self, rules_file: str):
        with open(rules_file, 'r', encoding='utf-8') as f:
            self.rules = yaml.safe_load(f)

    def evaluate(self, facts: dict, eval_date_str: str) -> dict:
        eval_date = datetime.strptime(eval_date_str, "%Y-%m-%d")
        results = []
        is_overall_valid = True

        for rule in self.rules:
            valid_from = datetime.strptime(rule['valid_from'], "%Y-%m-%d")
            if valid_from > eval_date:
                continue

            condition_str = rule['logic']['condition']
            
            try:
                is_passed = simple_eval(condition_str, names=facts)
            except Exception:
                is_passed = False

            if not is_passed:
                is_overall_valid = False

            results.append({
                "rule_id": rule['rule_id'],
                "status": "PASS" if is_passed else "FAIL",
                "law_reference": rule['law_reference'],
                "message": rule['on_failure']['message'] if not is_passed else None
            })

        return {
            "is_valid": is_overall_valid,
            "results": results
        }


# 4. FASTAPI RAKENDUS
app = FastAPI(title="Solvere Core PoC with DB")
solvere = SolvereEngine('rules.yaml')

# --- UUDIS: Täiendatud otspunkt ---
@app.post("/api/evaluate")
def evaluate_plan(request: EvaluateRequest, db: Session = Depends(get_db)):
    facts_dict = request.facts.dict()
    
    # 1. Jooksutame mootori
    decision = solvere.evaluate(facts_dict, request.evaluation_date)
    
    # 2. SALVESTAME AUDITI LOGI ANDMEBAASI
    db_log = EvaluationLog(
        is_valid=decision["is_valid"],
        request_payload={"evaluation_date": request.evaluation_date, "facts": facts_dict},
        response_payload=decision
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    
    # Lisame API vastusesse ka unikaalse Trace ID (andmebaasi rea ID)
    decision["trace_id"] = db_log.id
    
    return decision

@app.get("/", response_class=HTMLResponse)
def serve_ui():
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()