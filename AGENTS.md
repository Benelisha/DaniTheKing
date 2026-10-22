# Project working instructions

Every Git push must include a deployment. Run the required validation and ensure the pushed revision deploys successfully to Firebase project `daniboy-be1c0`. GitHub Actions is the preferred deployment path. Watch the deployment run and report its outcome; a successful push alone does not complete the task. If Actions is not configured, deploy the same revision with the local `npm run deploy` command and report any blocker.

Never commit credentials, `.env`, or generated Google authentication files.
