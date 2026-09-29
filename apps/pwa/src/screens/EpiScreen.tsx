import { EstoqueCatalogo } from '../components/EstoqueCatalogo';

export function EpiScreen() {
  return (
    <div>
      <h2 className="screen-title">EPIs</h2>
      <EstoqueCatalogo tipo="EPI" titulo="EPIs" singular="EPI" />
    </div>
  );
}
