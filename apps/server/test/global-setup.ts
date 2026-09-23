// Usado apenas quando DATABASE_URL não foi injetado; helper não roda nada por padrão.
export default async function setup() {
  console.log('global-setup: aguardando banco (use docker compose up -d db)');
}