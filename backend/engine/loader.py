import yaml
import os
from datetime import datetime
from typing import List, Dict, Optional


def load_rules(rules_dir: str, eval_date: datetime, module: Optional[str] = None) -> List[Dict]:
    active_rules = []
    search_path = os.path.join(rules_dir, module) if module else rules_dir

    for root, dirs, files in os.walk(search_path):
        for filename in sorted(files):
            if not filename.endswith('.yaml') and not filename.endswith('.yml'):
                continue

            filepath = os.path.join(root, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                rules_in_file = yaml.safe_load(f)

            if not rules_in_file:
                continue

            for rule in rules_in_file:
                valid_from = datetime.strptime(rule.get('valid_from', '1900-01-01'), "%Y-%m-%d")
                if valid_from > eval_date:
                    continue

                valid_until_str = rule.get('valid_until')
                if valid_until_str:
                    valid_until = datetime.strptime(valid_until_str, "%Y-%m-%d")
                    if eval_date > valid_until:
                        continue

                active_rules.append(rule)

    return active_rules