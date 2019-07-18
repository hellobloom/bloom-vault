#!/bin/bash
source './bin/strict-mode.sh'
docker-compose build
docker tag bloom-vault_productionvault:latest hellobloom/bloom-vault
docker push hellobloom/bloom-vault
