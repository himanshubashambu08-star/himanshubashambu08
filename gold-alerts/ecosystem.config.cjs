// pm2 process file:  pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'gold-alerts',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1, // must stay 1: two copies would fight over the same WhatsApp session
      autorestart: true,
      max_restarts: 50,
      min_uptime: '30s',
      restart_delay: 5000,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
      out_file: './data/logs/out.log',
      error_file: './data/logs/error.log',
      time: true,
    },
  ],
};
