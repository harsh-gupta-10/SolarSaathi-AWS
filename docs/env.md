# Environment Variables

Use placeholders only.

## Web
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` only if a browser-safe restricted key is used

## API
- `GOOGLE_GEOCODING_API_KEY`
- `GOOGLE_SOLAR_API_KEY`
- `AWS_REGION`
- `POLICY_BUCKET`
- `POLICY_TABLE`
- `APPLICATION_TABLE`
- `BEDROCK_TEXT_MODEL_ID`
- `BEDROCK_IMAGE_MODEL_ID`
- `BEDROCK_IMAGE_REGION`

## Auth
- Cognito user pool configuration
- Cognito client ID
- Cognito domain / issuer

## Rules
- Never put server secrets in `NEXT_PUBLIC_*`.
- Restrict Google keys by API and origin/IP as appropriate.
- Store production secrets using AWS-native secret/configuration mechanisms.
