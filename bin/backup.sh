#!/bin/bash
. './bin/strict-mode.sh'

while true; do
  sleep 86400
  if [[ -v BACKUP_LOCATION ]]; then
    echo RUNNING BACKUP
    tar cvf /backup/vault_backup_$(date +%Y%m%d%H%M%S).tar /dbdata
    echo BACKUP COMPLETE

    echo REMOVING OLD BACKUPS
    # Deletes files in /backup that end in .tar and are older than BACKUP_DAYS_TO_KEEP
    # Outputs to something like "find /backup -name *.tar -mtime +7 -type f -delete"
    # The output of what files will be removed can be tested by removing the -delete
    # Resources used:
    # - use of find to delete: https://stackoverflow.com/a/13489511/1165441
    # - default env var: https://stackoverflow.com/a/2013589/1165441
    find /backup -name "*.tar" -mtime +${BACKUP_DAYS_TO_KEEP:-7} -type f -delete
    echo OLD BACKUPS REMOVED
  fi
done