from pydantic import BaseModel, Field
from typing import Optional, List


class MajanduskavaFacts(BaseModel):
    total_expected_annual_costs: float = Field(..., gt=0)
    planned_reserve_capital: float = Field(..., ge=0)
    previous_year_total_costs: float = Field(..., ge=0)
    existing_loans: float = Field(..., ge=0)
    new_loan_amount: float = Field(..., ge=0)


class EvaluateRequest(BaseModel):
    evaluation_date: str
    module: str = "korteriuhistu"
    facts: MajanduskavaFacts


class Violation(BaseModel):
    rule_id: str
    message: str
    reference: str
    field: Optional[str] = None
    provided_value: Optional[float] = None
    required_minimum: Optional[float] = None


class TraceEntry(BaseModel):
    rule_id: str
    law_reference: str
    condition: str
    explanation: str
    result: str
    error: Optional[str] = None


class EvaluateResponse(BaseModel):
    status: str
    valid: bool
    violations: List[Violation]
    execution_trace: List[TraceEntry]
    trace_id: str