# Triage Labels

The five canonical skill roles map to the labels below. This repo also uses `resolved` as an explicit completion state.

| Skill role | Tracker label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Needs scope clarification, assessment, and classification. |
| `needs-info` | `needs-info` | Waiting for the reporter to supply necessary information. |
| `ready-for-agent` | `ready-for-agent` | Sufficiently specified for an agent to continue independently. |
| `ready-for-human` | `ready-for-human` | Requires user intervention: a decision, testing, or implementation. |
| `wontfix` | `wontfix` | Work has been declined. |
| Additional completion state | `resolved` | Work is actually complete and all acceptance criteria are satisfied. |

## State transitions

- Keep exactly one of these state labels on each classified issue. Category labels such as `bug` may coexist.
- When a decision, user testing, or user implementation is required, apply `ready-for-human`, describe the needed action and available evidence in a comment, and leave the issue open.
- After user intervention, apply `ready-for-agent` if an agent can continue the remaining work independently.
- Implementation that still needs required user testing remains `ready-for-human`.
- Once every acceptance criterion is satisfied, record the results, apply `resolved`, remove the previous state label, and close the issue with reason `completed`.
- For declined work, apply `wontfix`, remove the previous state label, and close with reason `not planned`.
- When reopening work, remove `resolved` or `wontfix` and classify the issue again.

When a skill mentions a canonical role, use its tracker label from the table. Edit the mapping here if the vocabulary changes.
