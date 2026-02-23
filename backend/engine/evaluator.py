from simpleeval import simple_eval
from typing import Dict, List, Any


def evaluate_rules(rules: List[Dict], facts: Dict[str, Any]) -> Dict:
    violations = []
    execution_trace = []
    is_valid = True

    for rule in rules:
        rule_id = rule['rule_id']
        condition_str = rule['logic']['condition']
        explanation = rule['logic'].get('explanation', '')

        try:
            result = simple_eval(condition_str, names=facts)
            passed = bool(result)
            error = None
        except Exception as e:
            passed = False
            error = f"Hindamisviga: {str(e)}"

        trace_entry = {
            "rule_id": rule_id,
            "law_reference": rule.get('law_reference', ''),
            "condition": condition_str,
            "explanation": explanation,
            "result": "PASS" if passed else "FAIL",
            "error": error
        }
        execution_trace.append(trace_entry)

        if not passed:
            is_valid = False
            failure = rule.get('on_failure', {})
            field = failure.get('field')
            provided_value = facts.get(field) if field else None

            violations.append({
                "rule_id": rule_id,
                "message": failure.get('message', 'Reegel ei ole täidetud.'),
                "reference": rule.get('law_reference', ''),
                "field": field,
                "provided_value": provided_value,
                "required_minimum": None
            })

    return {
        "valid": is_valid,
        "status": "accepted" if is_valid else "rejected",
        "violations": violations,
        "execution_trace": execution_trace
    }