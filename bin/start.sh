#!/bin/bash
. './bin/strict-mode.sh'
#. ./bin/set-env-secrets.sh
npm run migrate
npm run start
