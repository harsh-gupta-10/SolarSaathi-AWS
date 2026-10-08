# AWS Service Map

| Capability | AWS service |
|---|---|
| Web hosting | Amplify Hosting |
| Auth | Cognito |
| API | API Gateway |
| Compute | Lambda |
| Database | DynamoDB |
| Source documents | S3 |
| Generated images | S3 |
| Scheduling | EventBridge |
| AI text | Bedrock |
| AI image | Bedrock image model adapter |
| Logs/metrics | CloudWatch |
| Infrastructure | SAM/CloudFormation |

## EventBridge schedules

Suggested jobs:
- official policy crawl
- stale source detection
- policy change processing
- optional application reminders

## Lambda boundaries

Prefer separate functions/modules for:
- solar analysis
- policy fetch
- policy extraction
- policy validation
- benefit calculation
- application state
- advisor
- accessory recommendation
- design generation

## Bedrock

Use model IDs/configuration from environment/config, not hardcoded assumptions.

Image generation must support a separate region if the selected image model is unavailable in the primary application region.

## S3 security

- private buckets
- encryption
- least-privilege IAM
- signed URLs for private assets
- lifecycle rules for temporary crawl artifacts
- no public write access

## DynamoDB

- encryption
- point-in-time recovery where appropriate
- least-privilege access
- conditional writes for policy version activation
- audit records

## CloudWatch

Alert on:
- crawler failures
- policy conflicts
- stale critical sources
- API error spikes
- Bedrock failures
- Lambda errors
