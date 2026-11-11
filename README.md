# Forlab

The portfolio is hosted on GitHub Pages. Contact messages are stored in MongoDB Atlas through the Azure App Service API.

## Private messages dashboard

The dashboard is available at `/messages/` on the website. Configure these App Service environment variables before using it:

- `MONGODB_URI`: MongoDB Atlas connection string
- `ADMIN_USERNAME`: private dashboard username
- `ADMIN_PASSWORD`: private dashboard password
- `SESSION_SECRET`: long random secret used to sign expiring dashboard tokens

Keep these values in Azure App Service settings, never in the repository.

## Interactive lectures

The homepage links to the interactive learning experience at
`interactive.forlab.me/subjects/`. The subject and lecture prototypes live in
the `subjects/` directory and can be deployed to the interactive subdomain.