FROM node:20-alpine AS web-builder
WORKDIR /app

COPY package.json package-lock.json* tailwind.config.js ./
COPY web ./web
RUN npm ci
RUN npm run build

FROM golang:1.24-alpine AS go-builder
WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY scenarios ./scenarios
COPY web ./web
COPY --from=web-builder /app/web/static/assets ./web/static/assets

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/acs ./cmd/acs

FROM alpine:3.21
WORKDIR /app

RUN adduser -D -u 10001 app

COPY --from=go-builder /out/acs ./acs
COPY --from=go-builder /src/scenarios ./scenarios
COPY --from=go-builder /src/web ./web

EXPOSE 8080
USER app

CMD ["./acs", "serve", "-addr", ":8080", "-scenarios", "./scenarios", "-web", "./web"]
