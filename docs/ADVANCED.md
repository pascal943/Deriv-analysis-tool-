# Advanced User Guide

## Deriv Analysis Tool - Advanced Features

### 1. Portfolio Management

```python
from src.portfolio import PortfolioManager, Position

# Create portfolio
portfolio = PortfolioManager(initial_capital=100000)

# Add positions
pos = Position('AAPL', 'LONG', 100, 150.0, 155.0)
portfolio.add_position(pos)

# Get portfolio summary
summary = portfolio.get_portfolio_summary()
print(f"Portfolio Value: ${summary['portfolio_value']:,.2f}")

# Calculate Greeks
greeks = portfolio.calculate_Greeks()
```

### 2. Options Pricing & Analysis

```python
from src.derivatives import BlackScholesModel, OptionsAnalyzer

# Initialize
bs_model = BlackScholesModel(risk_free_rate=0.02)

# Price options
call_price = bs_model.call_price(S=100, K=100, T=0.25, r=0.02, sigma=0.2)
put_price = bs_model.put_price(S=100, K=100, T=0.25, r=0.02, sigma=0.2)

# Get Greeks
greeks = bs_model.option_greeks(S=100, K=100, T=0.25, r=0.02, sigma=0.2)

# Analyze strategies
analyzer = OptionsAnalyzer()
call_spread = analyzer.analyze_call_spread(S=100, K_long=95, K_short=105, 
                                          T=0.25, r=0.02, sigma=0.2)
```

### 3. Risk Management

```python
from src.risk_manager import RiskManager, PriceTargets
import pandas as pd

risk_mgr = RiskManager()

# Value at Risk
returns = pd.Series(returns_data)
var_95 = risk_mgr.calculate_value_at_risk(returns, confidence=0.95)

# Stress testing
scenarios = risk_mgr.calculate_stress_scenarios(portfolio_value=1000000, 
    price_shocks={'Bull': 10, 'Bear': -10})

# Price targets
targets = PriceTargets.calculate_fibonacci_levels(prices)
pivot = PriceTargets.calculate_pivot_points(high=105, low=95, close=100)
```

### 4. Backtesting Trading Strategies

```python
from src.backtest import BacktestEngine, StrategyBuilder
import pandas as pd

# Create backtest engine
engine = BacktestEngine(initial_capital=100000, commission=0.001)

# Run backtest with built-in strategies
results = engine.run_backtest(price_data, StrategyBuilder.momentum_strategy,
                             lookback=20, threshold=0.02)

# Results contain:
# - total_return, sharpe_ratio, max_drawdown
# - win_rate, num_trades, profit_factor
# - equity_curve, trades history
```

### 5. Market Data & Analysis

```python
from src.market_data import MarketDataFetcher, MarketAnalyzer

# Fetch data
fetcher = MarketDataFetcher()
data = fetcher.fetch_historical_data('AAPL', '2024-01-01', '2024-12-31')

# Market analysis
regime = MarketAnalyzer.get_market_regime(prices)
momentum = MarketAnalyzer.calculate_momentum_score(prices)
support_resistance = MarketAnalyzer.identify_support_resistance(prices)
```

## Available Trading Strategies

### 1. Momentum Strategy
```python
signals = StrategyBuilder.momentum_strategy(data, lookback=20, threshold=0.02)
```
- Buys when momentum > threshold
- Sells when momentum < -threshold

### 2. Mean Reversion Strategy
```python
signals = StrategyBuilder.mean_reversion_strategy(data, window=20, std_dev=2.0)
```
- Uses Bollinger Bands
- Buys on oversold (below lower band)
- Sells on overbought (above upper band)

### 3. MACD Strategy
```python
signals = StrategyBuilder.macd_strategy(data, fast=12, slow=26, signal_period=9)
```
- Buys on bullish MACD crossover
- Sells on bearish MACD crossover

### 4. RSI Strategy
```python
signals = StrategyBuilder.rsi_strategy(data, window=14, oversold=30, overbought=70)
```
- Buys when RSI < 30 (oversold)
- Sells when RSI > 70 (overbought)

## Performance Metrics

### Backtest Results Include:

- **Return Metrics**
  - Total return (%)
  - Annual return
  
- **Risk Metrics**
  - Annual volatility
  - Sharpe ratio
  - Maximum drawdown
  
- **Trade Metrics**
  - Win rate
  - Average win/loss
  - Profit factor
  - Total number of trades

- **Equity Curve**
  - Full equity curve history
  - Trade-by-trade details

## Best Practices

1. **Always validate data quality**
   ```python
   from src.data_processor import DataProcessor
   DataProcessor.validate_data(data)
   ```

2. **Use appropriate market regime**
   ```python
   regime = MarketAnalyzer.get_market_regime(prices)
   if regime == 'BULLISH':
       # Use momentum strategies
   ```

3. **Monitor position Greeks**
   ```python
   greeks = portfolio.calculate_Greeks()
   # Rebalance if delta gets too large
   ```

4. **Stress test your portfolio**
   ```python
   stress_results = risk_mgr.calculate_stress_scenarios(value, scenarios)
   ```

5. **Backtest before trading**
   ```python
   results = engine.run_backtest(data, strategy, **params)
   # Check metrics before live trading
   ```

## Common Workflows

### Complete Analysis Workflow
```python
# 1. Load data
market_data = fetcher.fetch_historical_data('AAPL', start, end)

# 2. Analyze market
regime = MarketAnalyzer.get_market_regime(market_data['close'])

# 3. Calculate indicators
sma = TechnicalIndicators.calculate_sma(market_data['close'])
rsi = TechnicalIndicators.calculate_rsi(market_data['close'])

# 4. Generate signals
signals = StrategyBuilder.momentum_strategy(market_data)

# 5. Backtest strategy
results = engine.run_backtest(market_data, StrategyBuilder.momentum_strategy)

# 6. Risk analysis
returns = market_data['close'].pct_change()
var = risk_mgr.calculate_value_at_risk(returns)

# 7. Generate report
print(f"Strategy Sharpe: {results['sharpe_ratio']:.4f}")
print(f"Max Drawdown: {results['max_drawdown_percent']:.2f}%")
print(f"Win Rate: {results['win_rate']*100:.1f}%")
```

## Troubleshooting

**Issue**: Low Sharpe ratio
- Solution: Adjust strategy parameters, consider different market regime

**Issue**: High drawdown
- Solution: Implement stop-losses, adjust position sizing

**Issue**: Low win rate
- Solution: Optimize entry/exit signals, combine multiple indicators

**Issue**: Implied volatility calculation not converging
- Solution: Check initial volatility guess, verify option price is reasonable
