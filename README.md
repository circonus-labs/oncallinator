oncallinator
============

Oncall scheduler using the Circonus API

Usage
=====

Create a .authtoken file and paste a Circonus API auth token into it

./oncallinator.js

Go to http://<host>:8080

The OnCall Contact Group is the group that this will act on, adding and removing users when they go on call.

Rotation Time is the time (24 hour format) that the oncall rotation shifts.

Click on a day of the week to set the user(s) for that day, in the modal select the name, then the contact method and then save when you are done.

Oncallinator checks the status of the oncall group at boot, you can run it out of cron at the appropriate times to make sure your schedule is up to date like so:
./oncallinator.js -D
