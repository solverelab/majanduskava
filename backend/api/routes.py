import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.schemas import EvaluateRequest, EvaluateResponse
from engine.loader import load_rules
from engine.evaluator import evaluate_rules
from models.database import EvaluationLog, get_db

router = APIRouter()

RULES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rules")


@router.post("/evaluate", response_model=EvaluateResponse)
def evaluate_plan(request: EvaluateRequest, db: Session = Depends(get_db)):
    try:
        eval_date = datetime.strptime(request.evaluation_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Kuupäev peab olema formaadis YYYY-MM-DD")

    rules = load_rules(RULES_DIR, eval_date, module=request.module)

    if not rules:
        raise HTTPException(status_code=404, detail=f"Moodul '{request.module}' ei leitud")

    facts_dict = request.facts.dict()
    result = evaluate_rules(rules, facts_dict)

    db_log = EvaluationLog(
        module=request.module,
        evaluation_date=request.evaluation_date,
        is_valid=result["valid"],
        request_payload={"evaluation_date": request.evaluation_date, "facts": facts_dict},
        response_payload=result
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)

    result["trace_id"] = db_log.id
    return result


@router.get("/health")
def health_check():
    return {"status": "ok", "service": "solvere-engine"}