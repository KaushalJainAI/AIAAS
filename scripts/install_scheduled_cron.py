"""One-shot helper (run ONCE on the EC2 host): install the scheduled-reminders
cron line idempotently. Not part of the app; lives in scripts/ so the exact
line that configures production is reviewed like code."""
import subprocess

LINE = (
    "* * * * * cd /home/ec2-user/aiaas && "
    "docker compose -f docker-compose.prod.yml exec -T backend "
    "python manage.py send_scheduled_notifications "
    ">> /var/log/aiaas-scheduled.log 2>&1"
)

cur = subprocess.run(["crontab", "-l"], capture_output=True, text=True).stdout
if "send_scheduled_notifications" in cur:
    print("already present")
else:
    subprocess.run(["crontab", "-"], input=cur + LINE + "\n",
                   text=True, check=True)
    print("installed")
