import { EstoqueCatalogo } from '../components/EstoqueCatalogo';

export function ConsumiveisScreen() {
  return (
    <div>
      <h2 className="screen-title">Consumíveis</h2>
      <EstoqueCatalogo tipo="CONSUMIVEL" titulo="Consumíveis" singular="consumível" />
    </div>
  );
}
