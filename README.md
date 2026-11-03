# Forlab

The portfolio is hosted on GitHub Pages. Contact messages are stored in MongoDB Atlas through the Azure App Service API.

## Private messages dashboard

The dashboard is available at `/messages/` on the website. Configure these App Service environment variables before using it:

- `MONGODB_URI`: MongoDB Atlas connection string
- `ADMIN_USERNAME`: private dashboard username
- `ADMIN_PASSWORD`: private dashboard password
- `SESSION_SECRET`: long random secret used to sign expiring dashboard tokens

Keep these values in Azure App Service settings, never in the repository.

## Social download tool

The downloader is served by the Azure App Service at `/` and is also available
from the repository path `socialdownload/index.html`. It accepts public direct
media URLs for content the visitor owns or is authorized to save; it does not
scrape social platforms or bypass private-content protections.

To publish `socialdownload.forlab.me`, add this DNS record at the domain
provider:

```text
Type: CNAME
Name: socialdownload
Target: forlab-api-8lay-ecb3cmfpd7gxbmba.italynorth-01.azurewebsites.net
```

Then add `socialdownload.forlab.me` as a custom domain in the Azure App
Service and enable its managed HTTPS certificate.