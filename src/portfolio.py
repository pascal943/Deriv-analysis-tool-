"""
Advanced portfolio management and position tracking
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class Position:
    """Represents a derivative position"""
    
    def __init__(self, symbol: str, position_type: str, size: float, 
                 entry_price: float, current_price: float, timestamp: datetime = None):
        """
        Initialize a position.
        
        Args:
            symbol: Asset symbol
            position_type: 'LONG' or 'SHORT'
            size: Position size
            entry_price: Entry price
            current_price: Current market price
            timestamp: Entry timestamp
        """
        self.symbol = symbol
        self.position_type = position_type
        self.size = size
        self.entry_price = entry_price
        self.current_price = current_price
        self.timestamp = timestamp or datetime.now()
        self.pnl = self._calculate_pnl()
        self.pnl_percent = self._calculate_pnl_percent()
    
    def _calculate_pnl(self) -> float:
        """Calculate profit/loss"""
        if self.position_type == 'LONG':
            return self.size * (self.current_price - self.entry_price)
        else:  # SHORT
            return self.size * (self.entry_price - self.current_price)
    
    def _calculate_pnl_percent(self) -> float:
        """Calculate profit/loss percentage"""
        if self.entry_price == 0:
            return 0
        return (self.pnl / (self.size * self.entry_price)) * 100
    
    def update_price(self, new_price: float) -> None:
        """Update current price"""
        self.current_price = new_price
        self.pnl = self._calculate_pnl()
        self.pnl_percent = self._calculate_pnl_percent()
    
    def to_dict(self) -> Dict:
        """Convert to dictionary"""
        return {
            'symbol': self.symbol,
            'type': self.position_type,
            'size': self.size,
            'entry_price': self.entry_price,
            'current_price': self.current_price,
            'pnl': self.pnl,
            'pnl_percent': self.pnl_percent,
            'timestamp': self.timestamp.isoformat()
        }


class PortfolioManager:
    """
    Manages derivative portfolio positions and risk metrics
    """
    
    def __init__(self, initial_capital: float = 100000):
        """
        Initialize portfolio manager.
        
        Args:
            initial_capital: Starting capital
        """
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.positions: List[Position] = []
        self.trades_history: List[Dict] = []
        self.daily_returns: List[float] = []
        logger.info(f"PortfolioManager initialized with ${initial_capital:,.2f}")
    
    def add_position(self, position: Position) -> None:
        """Add a position to portfolio"""
        self.positions.append(position)
        logger.info(f"Added {position.position_type} position: {position.symbol}")
    
    def close_position(self, symbol: str) -> Optional[Position]:
        """Close a position by symbol"""
        for i, pos in enumerate(self.positions):
            if pos.symbol == symbol:
                closed_pos = self.positions.pop(i)
                self.trades_history.append({
                    'symbol': symbol,
                    'action': 'CLOSE',
                    'pnl': closed_pos.pnl,
                    'pnl_percent': closed_pos.pnl_percent,
                    'timestamp': datetime.now().isoformat()
                })
                logger.info(f"Closed position: {symbol}, P&L: ${closed_pos.pnl:,.2f}")
                return closed_pos
        return None
    
    def update_prices(self, price_data: Dict[str, float]) -> None:
        """Update prices for all positions"""
        for position in self.positions:
            if position.symbol in price_data:
                position.update_price(price_data[position.symbol])
    
    def get_portfolio_value(self) -> float:
        """Calculate total portfolio value"""
        total_pnl = sum(pos.pnl for pos in self.positions)
        return self.current_capital + total_pnl
    
    def get_total_pnl(self) -> float:
        """Get total P&L"""
        return sum(pos.pnl for pos in self.positions)
    
    def get_total_pnl_percent(self) -> float:
        """Get total P&L percentage"""
        total_pnl = self.get_total_pnl()
        portfolio_value = self.get_portfolio_value()
        if portfolio_value == 0:
            return 0
        return (total_pnl / portfolio_value) * 100
    
    def get_position_by_symbol(self, symbol: str) -> Optional[Position]:
        """Get position by symbol"""
        for pos in self.positions:
            if pos.symbol == symbol:
                return pos
        return None
    
    def get_long_positions(self) -> List[Position]:
        """Get all long positions"""
        return [pos for pos in self.positions if pos.position_type == 'LONG']
    
    def get_short_positions(self) -> List[Position]:
        """Get all short positions"""
        return [pos for pos in self.positions if pos.position_type == 'SHORT']
    
    def get_portfolio_summary(self) -> Dict:
        """Get comprehensive portfolio summary"""
        summary = {
            'initial_capital': self.initial_capital,
            'portfolio_value': self.get_portfolio_value(),
            'total_pnl': self.get_total_pnl(),
            'total_pnl_percent': self.get_total_pnl_percent(),
            'num_positions': len(self.positions),
            'num_long': len(self.get_long_positions()),
            'num_short': len(self.get_short_positions()),
            'largest_win': max([pos.pnl for pos in self.positions], default=0),
            'largest_loss': min([pos.pnl for pos in self.positions], default=0),
            'positions': [pos.to_dict() for pos in self.positions],
            'timestamp': datetime.now().isoformat()
        }
        return summary
    
    def calculate_Greeks(self) -> Dict:
        """Calculate portfolio Greeks (delta, gamma, vega, theta, rho)"""
        # Simplified Greeks calculation
        total_delta = sum(pos.size for pos in self.get_long_positions()) - \
                     sum(pos.size for pos in self.get_short_positions())
        
        return {
            'delta': total_delta,
            'gamma': len(self.positions) * 0.1,  # Simplified
            'vega': len(self.positions) * 0.05,  # Simplified
            'theta': -len(self.positions) * 0.01,  # Simplified
            'rho': len(self.positions) * 0.02  # Simplified
        }
