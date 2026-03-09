#!/bin/bash

apt update && apt upgrade -y
apt install -y git curl nodejs npm docker.io docker-compose

useradd -m hsdarena
usermod -aG sudo,docker hsdarena
passwd hsdarena

systemctl enable docker
systemctl start docker

sudo -u hsdarena /bin/bash -c "cd /home/hsdarena && git clone git@github.com:ARENA-HSD/api.git"
sudo -u hsdarena /bin/bash -c "cd /home/hsdarena && git clone git@github.com:ARENA-HSD/frontend.git"

cloudflare_ip_range=("173.245.48.0/20"
"103.21.244.0/22"
"103.22.200.0/22"
"103.31.4.0/22"
"141.101.64.0/18"
"108.162.192.0/18"
"190.93.240.0/20"
"188.114.96.0/20"
"197.234.240.0/22"
"198.41.128.0/17"
"162.158.0.0/15"
"104.16.0.0/13"
"104.24.0.0/14"
"172.64.0.0/13"
"131.0.72.0/22")

for ip_range in "${cloudflare_ip_range[@]}"; do
    ufw allow from $ip_range to any port 80
    ufw allow from $ip_range to any port 443
done

sed -i 's/^#*Port .*/Port 17943/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config

ufw allow 17943
ufw default deny incoming
ufw default allow outgoing
ufw enable

systemctl daemon-reload
systemctl restart sshd