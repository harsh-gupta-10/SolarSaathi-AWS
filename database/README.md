# Database

DynamoDB is the application source of truth.

See `docs/database.md` for entity design and access patterns.

Infrastructure should create tables with the least privilege IAM policies required by each Lambda.
