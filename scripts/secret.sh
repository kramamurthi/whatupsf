#!/bin/bash

heroku config:set SECRET_KEY=`openssl rand -base64 32`
heroku config:set PYTHONHASHSEED=random
