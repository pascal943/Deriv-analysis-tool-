"""
Risk management and analysis module
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class RiskManager:
    """Comprehensive risk management for derivative portfolios"""
    
    def __init__(self):
        """Initialize risk manager"""
        self.var_confidence = 0.95  # 95% VaR
        self.position_limits = {}
        logger.info("RiskManager initialized")
    
    def calculate_value_at_risk(self, returns: pd.Series, confidence: float = 0.95) -> float:
        """Calculate Value at Risk (VaR)"""
        return np.percentile(returns, (1 - confidence) * 100)
    
    def calculate_conditional_var(self, returns: pd.Series, confidence: float = 0.95) -> float:
        """Calculate Conditional VaR (Expected Shortfall)"""
        var = self.calculate_value_at_risk(returns, confidence)
        return returns[returns <= var].mean()
    
    def calculate_beta(self, returns: pd.Series, market_returns: pd.Series) -> float:
        """Calculate Beta relative to market"""
        covariance = np.cov(returns, market_returns)[0][1]
        market_variance = np.var(market_returns)
        if market_variance == 0:
            return 0
        return covariance / market_variance
    
    def calculate_correlation_matrix(self, price_data: pd.DataFrame) -> pd.DataFrame:
        """Calculate correlation matrix between assets"""
        returns = price_data.pct_change()
        return returns.corr()
    
    def calculate_concentration_risk(self, positions: List[Dict]) -> Dict:
        """Calculate portfolio concentration risk"""
        if not positions:
            return {'hhi': 0, 'max_concentration': 0}
        
        total_value = sum(p['value'] for p in positions)
        weights = [p['value'] / total_value for p in positions]
        
        # Herfindahl-Hirschman Index
        hhi = sum(w ** 2 for w in weights)
        
        return {
            'hhi': hhi,
            'max_concentration': max(weights),
            'num_positions': len(positions),
            'diversification_score': 1 - hhi
        }
    
    def calculate_stress_scenarios(self, portfolio_value: float, 
                                  price_shocks: Dict[str, float]) -> Dict:
        """Calculate portfolio impact under stress scenarios"""
        scenarios = {}
        for scenario_name, price_change in price_shocks.items():
            impact = portfolio_value * (price_change / 100)
            scenarios[scenario_name] = {
                'price_change_percent': price_change,
                'impact': impact,
                'new_value': portfolio_value + impact
            }
        
        return scenarios
    
    def calculate_liquidity_risk(self, positions: List[Dict]) -> Dict:
        """Calculate liquidity risk metrics"""
        total_value = sum(p['value'] for p in positions)
        illiquid_positions = [p for p in positions if p.get('daily_volume', 0) < p['value'] * 0.1]
        
        return {
            'illiquid_positions': len(illiquid_positions),
            'illiquid_value': sum(p['value'] for p in illiquid_positions),
            'illiquid_ratio': sum(p['value'] for p in illiquid_positions) / total_value if total_value > 0 else 0,
            'positions': positions
        }
    
    def calculate_drawdown(self, prices: pd.Series) -> Dict:
        """Calculate maximum drawdown and related metrics"""
        cumulative = (1 + prices.pct_change()).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = (cumulative - running_max) / running_max
        max_drawdown = drawdown.min()
        
        # Duration of drawdown
        drawdown_duration = 0
        current_duration = 0
        max_duration = 0
        
        for dd in drawdown:
            if dd < 0:
                current_duration += 1
                max_duration = max(max_duration, current_duration)
            else:
                current_duration = 0
        
        return {
            'max_drawdown': max_drawdown,
            'max_drawdown_percent': max_drawdown * 100,
            'max_drawdown_duration': max_duration,
            'current_drawdown': drawdown.iloc[-1] if len(drawdown) > 0 else 0
        }
    
    def calculate_recovery_factor(self, total_pnl: float, max_loss: float) -> float:
        """Calculate recovery factor"""
        if max_loss >= 0 or max_loss == 0:
            return 0
        return total_pnl / abs(max_loss)
    
    def check_position_limits(self, symbol: str, position_size: float) -> Dict:
        """Check if position violates limits"""
        if symbol not in self.position_limits:
            return {'valid': True, 'message': 'No limit set for this symbol'}
        
        limit = self.position_limits[symbol]
        if position_size <= limit:
            return {'valid': True, 'message': f'Position within limit: {limit}'}
        else:
            return {'valid': False, 'message': f'Position exceeds limit: {limit}'}
    
    def set_position_limit(self, symbol: str, limit: float) -> None:
        """Set position limit for symbol"""
        self.position_limits[symbol] = limit
        logger.info(f"Set position limit for {symbol}: {limit}")


class PriceTargets:
    """Calculate price targets and support/resistance levels"""
    
    @staticmethod
    def calculate_support_resistance(prices: pd.Series, window: int = 20) -> Dict:
        """Calculate support and resistance levels"""
        high = prices.rolling(window=window).max()
        low = prices.rolling(window=window).min()
        
        return {
            'resistance': high.iloc[-1],
            'support': low.iloc[-1],
            'midpoint': (high.iloc[-1] + low.iloc[-1]) / 2,
            'range': high.iloc[-1] - low.iloc[-1]
        }
    
    @staticmethod
    def calculate_fibonacci_levels(prices: pd.Series) -> Dict:
        """Calculate Fibonacci retracement levels"""
        high = prices.max()
        low = prices.min()
        diff = high - low
        
        return {
            'level_0': high,
            'level_236': high - (diff * 0.236),
            'level_382': high - (diff * 0.382),
            'level_500': high - (diff * 0.5),
            'level_618': high - (diff * 0.618),
            'level_786': high - (diff * 0.786),
            'level_100': low
        }
    
    @staticmethod
    def calculate_pivot_points(high: float, low: float, close: float) -> Dict:
        """Calculate pivot points"""
        pivot = (high + low + close) / 3
        r1 = (2 * pivot) - low
        s1 = (2 * pivot) - high
        r2 = pivot + (high - low)
        s2 = pivot - (high - low)
        
        return {
            'pivot': pivot,
            'resistance_1': r1,
            'resistance_2': r2,
            'support_1': s1,
            'support_2': s2
        }
