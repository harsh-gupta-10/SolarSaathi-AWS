# Authentication and Authorization

## Authentication

Use Amazon Cognito.

Desired login:
- Google
- email/password only if time permits

Google is configured as a Cognito federated identity provider, not as a separate application database.

## Roles

MVP:
- `HOMEOWNER`
- `BROKER`

Future:
- `BROKER_OWNER`
- `BROKER_MANAGER`
- `BROKER_AGENT`
- `ADMIN`

## Authorization

Frontend route guards improve UX but are not security.

Backend Lambda must:
1. validate Cognito JWT/API Gateway authorizer context,
2. resolve user identity,
3. load role/organization,
4. enforce ownership or organization scope.

## Onboarding

First login:
```text
Google
 ↓
Cognito
 ↓
Create SolarSaathi user
 ↓
Choose Homeowner / Solar Professional
 ↓
If broker: create/join organization
```

Do not allow a normal homeowner to self-escalate to a broker role through an untrusted request.

For the hackathon, broker role may be assigned through a controlled seed/admin process if necessary.
