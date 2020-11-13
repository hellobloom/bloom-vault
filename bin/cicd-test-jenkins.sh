#!/usr/bin/env sh
echo "Setting DEBIAN_FRONTEND to noninteractive for zero interaction while installing or upgrading the system via apt"
export DEBIAN_FRONTEND="noninteractive"

echo "Installing base dependencies"
apt -y update
apt -y install curl


echo "Installing Node 10"
# https://github.com/nodesource/distributions/blob/master/README.md
curl -sL https://deb.nodesource.com/setup_10.x | bash -
apt -y install nodejs

echo "Node / NPM Versions"
node -v
npm -v

echo "Installing postgres"
apt -y install postgresql postgresql-contrib
psql --version
pg_ctlcluster 12 main start

echo "Running ./bin/ci-test.sh"
./bin/ci-test.sh
