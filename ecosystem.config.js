module.exports = {
  apps: [
    {
      name: 'whatsapp-spam-guard',
      script: 'src/index.js',
      node_args: '--disable-warning=ExperimentalWarning',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      watch: false,
      env: { NODE_ENV: 'production' },
    },
  ],
};
