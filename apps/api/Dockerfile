ARG GO_VERSION=1.26.0
ARG NODE_VERSION=18
ARG POSTMAN_TO_OPENAPI_VERSION=3.0.1
ARG CURLCONVERTER_VERSION=4.12.0

FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/mock-loom-api ./cmd/server

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG POSTMAN_TO_OPENAPI_VERSION
ARG CURLCONVERTER_VERSION

WORKDIR /app

ENV NODE_ENV=production
ENV MOCK_LOOM_IMPORT_POSTMAN_CLI_PATH=p2o
ENV MOCK_LOOM_IMPORT_CURL_CLI_PATH=curlconverter
ENV MOCK_LOOM_MIGRATIONS_DIR=db/migrations

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

RUN npm install -g "postman-to-openapi@${POSTMAN_TO_OPENAPI_VERSION}" "curlconverter@${CURLCONVERTER_VERSION}" \
	&& p2o --help >/dev/null \
	&& curlconverter --help >/dev/null

COPY --from=build /out/mock-loom-api /app/mock-loom-api
COPY db/migrations /app/db/migrations
COPY scripts/check-import-tools.sh /app/scripts/check-import-tools.sh

RUN chmod +x /app/mock-loom-api /app/scripts/check-import-tools.sh

EXPOSE 8080

ENTRYPOINT ["/app/scripts/check-import-tools.sh"]
