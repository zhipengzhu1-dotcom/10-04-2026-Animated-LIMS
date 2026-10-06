# Queues are derived from rules, not written as SQL

A Queue lists the records of one kind on which one person is offered one action, so it restates that action's rule. Each Queue is therefore a stage, a plain SQL query for the records at that point of the work, filtered in JavaScript by the rule itself (`!RULES[action](record, person)`), and is never a SQL condition of its own. A Queue then cannot list a record its rule refuses. The cost is loading a stage's rows to count a badge, which at a contract lab's volumes is hundreds of rows.

## Considered Options

- **SQL beside the rule.** Keeps the counting in the database, but the rule is still written twice and only the agreement sweep notices drift. This is what we had in `TEST_QUEUES`.
- **One declarative condition compiled to both JavaScript and SQL.** True single source, but it is a small query language, and the refusal messages rules return do not fit it.

## Consequences

- A stage too narrow drops records silently; the agreement sweep and the administrator's oversight view, which shows stages unfiltered, both expose it.
- A person without an action's permission gets an empty Queue; Queues carry no permission of their own.
- Surfaces limit, sort or combine a Queue after the rule has filtered it, never in the stage's SQL.
