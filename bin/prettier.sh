#!/bin/bash

. './bin/strict-mode.sh'

list_prettier_supported_files() {
  git ls-files '.babelrc' '.prettierrc' '.sequelizerc' '*.css' '*.js' '*.json' '*.md' '*.ts' '*.tsx'
}

rewrite_with_prettier() {
  xargs node_modules/.bin/prettier --write --config .prettierrc
}

list_prettier_supported_files | rewrite_with_prettier
