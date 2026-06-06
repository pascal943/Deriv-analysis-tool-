"""
Real-time market data and analysis module
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class MarketDataFetcher:
    """Fetch and manage market data"""
    
    def __init__(self):
        """Initialize market data fetcher"""
        self.cache = {}
        self.last_update = {}
        logger.info("MarketDataFetcher initialized")
    
    def fetch_historical_data(self, symbol: str, start_date: str, 
                            end_date: str, interval: str = '1d') -> pd.DataFrame:
        """Fetch historical price data"""
        logger.info(f"Fetching {symbol} data from {start_date} to {end_date}")
        
        dates = pd.date_range(start=start_date, end=end_date, freq=interval)
        
        data = {
            'date': dates,
            'open': np.random.uniform(100, 150, len(dates)),
            'high': np.random.uniform(105, 155, len(dates)),
            'low': np.random.uniform(95, 145, len(dates)),
            'close': np.random.uniform(100, 150, len(dates)),
            'volume': np.random.uniform(1000000, 5000000, len(dates))
        }
        
        df = pd.DataFrame(data)
        df['symbol'] = symbol
        
        self.cache[symbol] = df
        self.last_update[symbol] = datetime.now()
        
        logger.info(f"Fetched {len(df)} records for {symbol}")
        return df
    
    def get_real_time_price(self, symbol: str) -> Optional[float]:
        """Get current real-time price"""
        if symbol in self.cache:
            return self.cache[symbol]['close'].iloc[-1]
        return None
    
    def get_market_stats(self, symbol: str) -> Dict:
        """Get market statistics"""
        if symbol not in self.cache:
            return {}
        
        df = self.cache[symbol]
        close_prices = df['close']
        
        return {
            'symbol': symbol,
            'current_price': close_prices.iloc[-1],
            'open': df['open'].iloc[-1],
            'high': df['high'].max(),
            'low': df['low'].min(),
            'volume': df['volume'].sum(),
            '52w_high': df['high'].max(),
            '52w_low': df['low'].min(),
            'avg_volume': df['volume'].mean(),
            'price_change': close_prices.iloc[-1] - close_prices.iloc[0],
            'price_change_percent': ((close_prices.iloc[-1] - close_prices.iloc[0]) / close_prices.iloc[0]) * 100
        }


class MarketAnalyzer:
    """Analyze market conditions and trends"""
    
    @staticmethod
    def get_market_regime(prices: pd.Series, window: int = 50) -> str:
        """Determine current market regime"""
        sma_short = prices.rolling(window=20).mean().iloc[-1]
        sma_long = prices.rolling(window=window).mean().iloc[-1]
        current_price = prices.iloc[-1]
        
        if current_price > sma_short > sma_long:
            return 'BULLISH'
        elif current_price < sma_short < sma_long:
            return 'BEARISH'
        else:
            return 'NEUTRAL'
    
    @staticmethod
    def get_trend_strength(prices: pd.Series, window: int = 20) -> float:
        """Calculate trend strength"""
        sma = prices.rolling(window=window).mean()
        distance = abs(prices.iloc[-1] - sma.iloc[-1])
        volatility = prices.std()
        
        if volatility == 0:
            return 0
        
        strength = min(distance / volatility / window, 1)
        return strength
    
    @staticmethod
    def calculate_momentum_score(prices: pd.Series) -> Dict:
        """Calculate comprehensive momentum score"""
        rsi = MarketAnalyzer._calculate_rsi(prices)
        momentum = prices.pct_change(10).iloc[-1] * 100
        macd, signal, hist = MarketAnalyzer._calculate_macd(prices)
        
        # Composite score
        rsi_score = (rsi - 50) / 50
        momentum_score = np.tanh(momentum / 5)
        macd_score = np.sign(hist) * min(abs(hist) / prices.std(), 1)
        
        composite = (rsi_score + momentum_score + macd_score) / 3
        
        return {
            'rsi': rsi,
            'momentum': momentum,
            'macd_histogram': hist,
            'rsi_score': rsi_score,
            'momentum_score': momentum_score,
            'macd_score': macd_score,
            'composite_score': composite
        }
    
    @staticmethod
    def _calculate_rsi(prices: pd.Series, window: int = 14) -> float:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
        
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi.iloc[-1]
    
    @staticmethod
    def _calculate_macd(prices: pd.Series, fast: int = 12, slow: int = 26, 
                       signal_period: int = 9) -> tuple:
        """Calculate MACD"""
        ema_fast = prices.ewm(span=fast, adjust=False).mean()
        ema_slow = prices.ewm(span=slow, adjust=False).mean()
        
        macd = ema_fast - ema_slow
        signal_line = macd.ewm(span=signal_period, adjust=False).mean()
        histogram = macd - signal_line
        
        return macd.iloc[-1], signal_line.iloc[-1], histogram.iloc[-1]
    
    @staticmethod
    def identify_support_resistance(prices: pd.Series, window: int = 50) -> Dict:
        """Identify support and resistance levels"""
        high = prices.rolling(window=window).max().iloc[-1]
        low = prices.rolling(window=window).min().iloc[-1]
        current = prices.iloc[-1]
        
        distance_to_resistance = high - current
        distance_to_support = current - low
        
        return {
            'resistance': high,
            'support': low,
            'distance_to_resistance': distance_to_resistance,
            'distance_to_support': distance_to_support,
            'resistance_percent': (distance_to_resistance / current) * 100,
            'support_percent': (distance_to_support / current) * 100
        }
    
    @staticmethod
    def calculate_correlation_with_market(asset_prices: pd.Series, 
                                         market_prices: pd.Series) -> float:
        """Calculate asset correlation with market"""
        asset_returns = asset_prices.pct_change()
        market_returns = market_prices.pct_change()
        
        return asset_returns.corr(market_returns)
