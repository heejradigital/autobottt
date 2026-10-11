module.exports = {
  apps: [
    {
      name: "infomaulid-bot",
      cwd: "/opt/infomaulid-bot",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 50,
      min_uptime: "10s",
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
