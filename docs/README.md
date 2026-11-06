# Documentation map

Start here, then follow the document for the type of work you are doing:

| Need | Document |
| --- | --- |
| Run, test, or deploy the app | [`../README.md`](../README.md) |
| Understand the shipped v1 game rules and secrecy boundary | [`game-spec.md`](game-spec.md) |
| Understand product goals and v2 acceptance targets | [`product-requirements.md`](product-requirements.md) |
| Implement or track v2 work | [`../openspec/changes/night-table-v2/`](../openspec/changes/night-table-v2/) |
| Understand OpenSpec workflow configuration | [`../openspec/config.yaml`](../openspec/config.yaml) |

## Source-of-truth rules

- The code and tests define implemented behavior.
- `game-spec.md` documents the v1 baseline and should change only when the
  shipped baseline changes.
- `product-requirements.md` records product intent and is not an implementation
  checklist.
- The active OpenSpec change owns v2 design decisions, capability requirements,
  and implementation progress. Do not create a second checklist at the
  repository root.

## OpenSpec change layout

```text
openspec/changes/night-table-v2/
  proposal.md       why and scope
  design.md         implementation approach
  specs/*/spec.md   capability requirements and scenarios
  tasks.md          executable implementation tracker
```

When v2 work is complete, archive the change through the OpenSpec workflow. Do
not manually move its files into `openspec/specs/`.
