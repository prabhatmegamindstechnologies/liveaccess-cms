#!/bin/sh
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand): exit 0 skips the build, anything else builds.
# A commit that only changes the website's own files (a CMS publish) doesn't need the CMS rebuilt.
# No parent commit (or any git error) exits non-zero, so the build runs.
git diff --quiet HEAD^ HEAD -- . \
  ':(exclude,glob)*.html' ':(exclude,glob)*.css' ':(exclude,glob)*.js' ':(exclude,glob)*.png' \
  ':(exclude,glob)*.svg' ':(exclude,glob)*.txt' ':(exclude,glob)*.xml' ':(exclude,glob)*.woff2' \
  ':(exclude).htaccess' ':(exclude,glob)images/**'
