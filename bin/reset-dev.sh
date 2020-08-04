#!/bin/bash
bin_dir=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
. $bin_dir/../.env.debug
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h localhost -p 5434 -U postgres -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h localhost -p 5434 -U postgres $POSTGRES_DATABASE
