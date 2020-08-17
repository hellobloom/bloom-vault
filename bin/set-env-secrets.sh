#!/bin/bash

: ${ENV_SECRETS_DIR:=/var/run/secrets}
debug=${ENV_SECRETS_DEBUG:-'unset'}

env_secret_debug()
{
    if [[ $debug = "true" ]]; then
        echo -e "\033[1m$@\033[0m"
    fi
}

set_env_secrets() {
    secret_file_path="${ENV_SECRETS_DIR}/env"
    env_secret_debug "Secret file: env"
    if [ -f "$secret_file_path" ]; then
        while IFS='' read -r line || [[ -n "$line" ]]; do
            if [[ ! $line = \#* && ! $line = "" ]]; then
              export $line
            fi
        done < "$secret_file_path"
    else
        env_secret_debug "Secret file does not exist! ${ENV_SECRETS_DIR}/env"
    fi

    if [[ $debug = "true" ]]; then
        echo -e "\n\033[1mExpanded environment variables\033[0m"
        printenv
    fi
}

set_env_secrets
