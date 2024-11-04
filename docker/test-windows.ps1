$env:CI = "1"
$env:FAST_TEST_RUN = "1"
npm ci -ignore-script node-pty
npm run lint
npm run format
npm run package
npm run integration-test
