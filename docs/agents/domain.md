# Domain Docs

This repo uses a single-context layout:

- `GLOSSARY.md` at the repo root defines domain vocabulary.
- `docs/adr/` contains architecture decision records.

## Before exploring

Read `GLOSSARY.md`, then use `docs/domain-overview.md` for the relationships between reading experiences and their source locations. Read the ADRs relevant to the area you will change.
If a domain document is absent, proceed silently. The `domain-modeling` skill creates the glossary and ADRs lazily as terminology and decisions are resolved.

## Use the glossary's vocabulary

Use glossary terms in issues, designs, code, hypotheses, and test names. When a necessary term is missing, reconsider whether it belongs to the domain; record a real terminology gap for `domain-modeling`.

## Surface ADR conflicts

If a proposal contradicts an existing ADR, identify that ADR and explain why the decision should be reconsidered.
