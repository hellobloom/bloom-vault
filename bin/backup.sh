#!/bin/bash
source './bin/strict-mode.sh'

while true; do
  sleep 86400
  if [[ -v BACKUP_LOCATION ]]; then
    echo RUNNING BACKUP
    tar cvf /backup/vault_backup_$(date +%Y%m%d%H%M%S).tar /dbdata
    echo BACKUP COMPLETE
  fi
done