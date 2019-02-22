#!/bin/bash
source './bin/strict-mode.sh'
source ./bin/set-env-secrets.sh
npm run migrate
npm run start