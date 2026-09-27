# Node 22: Vite 8, @rolldown/plugin-babel (the React Compiler) and Vitest 5
# all require >=22.12, and CI already builds on 22.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

# No VITE_* build args: the app uses same-origin relative URLs, which nginx.conf
# proxies. These used to default to localhost, and because Vite applies real
# process env *after* .env files, an image built without --build-arg silently
# shipped a production bundle pointed at localhost:8000.
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
