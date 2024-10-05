import flet as ft

class ThreeXThree:
    def __init__(self, b_width, b_height, board, position) -> None:
        self.board = board  
        self.position = position  
        self.disabled_positions = []  # Posiciones deshabilitadas en este ThreeXThree
        self.won = False  # Indica si este ThreeXThree ha sido ganado

        # Buttons
        self.buttons = [
            ft.ElevatedButton(
                style=ft.ButtonStyle(shape=ft.RoundedRectangleBorder(radius=5)), 
                width=b_width, 
                height=b_height,
                on_click=self.on_button_click,
                data=i  # Posición del botón en el grid de 3x3
            ) for i in range(9)
        ]

        row1 = ft.Row([self.buttons[0], self.buttons[1], self.buttons[2]])
        row2 = ft.Row([self.buttons[3], self.buttons[4], self.buttons[5]])
        row3 = ft.Row([self.buttons[6], self.buttons[7], self.buttons[8]])

        # Grid
        self.grid = ft.Column([row1, row2, row3])

        # Container
        self.inner_container = ft.Container(
            content=self.grid,  
            bgcolor="transparent", 
            padding=10,
            alignment=ft.alignment.center,  
            width=b_width * 3 + 40,  
            height=b_height * 3 + 40,  
            border_radius=10,
            border=ft.border.all(0, ft.colors.TRANSPARENT)  # Sin borde al inicio
        )

        self.container = ft.Container(
            content=self.inner_container,  
            bgcolor="transparent",  
            padding=20,
            alignment=ft.alignment.center, 
        )

        # Actual player
        self.player = self.board.player

    def three_in_row(self, game):
        # Definimos todas las combinaciones ganadoras posibles
        winner_combinations = [
            [0, 1, 2],  # Fila 1
            [3, 4, 5],  # Fila 2
            [6, 7, 8],  # Fila 3
            [0, 3, 6],  # Columna 1
            [1, 4, 7],  # Columna 2
            [2, 5, 8],  # Columna 3
            [0, 4, 8],  # Diagonal principal
            [2, 4, 6]   # Diagonal inversa
        ]
        
        # Recorrer cada combinación ganadora
        for combination in winner_combinations:
            colors = []
            for x,y in game:
                if x in combination:
                    colors.append(y)
            
            if len(colors) == 3 and (colors[0] == colors[1] == colors[2]):
                return True

    def on_button_click(self, e):
        if self.board.first_turn == 1:
            self.board.disable()
            self.board.first_turn = 0
    
        # Cambiar color del botón y desactivar
        if self.board.player == "red":
            e.control.style = ft.ButtonStyle(
                bgcolor=ft.colors.RED,  
                shape=ft.RoundedRectangleBorder(radius=1),
            )
            self.board.player = "blue"
        elif self.board.player == "blue":
            e.control.style = ft.ButtonStyle(
                bgcolor=ft.colors.BLUE,  
                shape=ft.RoundedRectangleBorder(radius=1),
            )
            self.board.player = "red"

        e.control.disabled = True  
        e.control.update()

        button_position = e.control.data
        self.disabled_positions.append((button_position, self.board.player))

        # Verificar si hay un tres en raya en el ThreeXThree seleccionado anteriormente
        if self.board.last_selected is not None:
            if not self.board.last_selected.won and self.board.last_selected.three_in_row(self.board.last_selected.disabled_positions):
                self.board.last_selected.won = True
                # Cambiar el color del contenedor al color del jugador ganador
                self.board.last_selected.inner_container.bgcolor = ft.colors.RED if self.board.player == "blue" else ft.colors.BLUE
            elif self.board.last_selected.won:
                self.board.last_selected.inner_container.border = None
            else:
                self.board.last_selected.inner_container.bgcolor = "transparent"
            self.board.last_selected.inner_container.update()
            self.board.last_selected.disable()
        

        # Cambiar color del ThreeXThree actual y habilitar  
        corresponding_threeXthree = self.board.get_threeXthree(button_position)
        if corresponding_threeXthree.won:
            corresponding_threeXthree.inner_container.border = ft.border.all(5, ft.colors.WHITE54)
        corresponding_threeXthree.inner_container.update()
        corresponding_threeXthree.unable()

        # Actualizar el último ThreeXThree seleccionado
        self.board.last_selected = corresponding_threeXthree

    def get_grid(self):
        return self.container
    
    # Deshabilitar todos los botones del ThreeXThree
    def disable(self):
        for b in self.buttons:
            b.disabled = True  # Desactivar botón
            b.update()

    # Habilitar los botones del ThreeXThree, excepto los que ya han sido seleccionados
    def unable(self):
        for i, button in enumerate(self.buttons):
            if i not in [x for x, _ in self.disabled_positions]:
                button.disabled = False  # Solo habilitar los botones que no han sido seleccionados
            button.update()

class Board:
    def __init__(self, b_width, b_height) -> None:
        # First turn
        self.first_turn = 1

        # Player
        self.player = "red"

        # Último ThreeXThree seleccionado
        self.last_selected = None

        # Crear la cuadrícula de 9 ThreeXThree
        self.threeXthree = [
            ThreeXThree(b_width, b_height, self, i) for i in range(9)
        ]

        line_vertical = ft.Container(width=8, height=b_height*3 + 80, bgcolor=ft.colors.WHITE70)
        line_horizontal = ft.Container(height=8, width=(b_width*3 + 80)*3 + 20, bgcolor=ft.colors.WHITE70)

        row1 = ft.Row([self.threeXthree[0].get_grid(), line_vertical, self.threeXthree[1].get_grid(), line_vertical, self.threeXthree[2].get_grid()], spacing=0)
        row2 = ft.Row([self.threeXthree[3].get_grid(), line_vertical, self.threeXthree[4].get_grid(), line_vertical, self.threeXthree[5].get_grid()], spacing=0)
        row3 = ft.Row([self.threeXthree[6].get_grid(), line_vertical, self.threeXthree[7].get_grid(), line_vertical, self.threeXthree[8].get_grid()], spacing=0)

        # Board
        self.board = ft.Column([row1, line_horizontal, row2, line_horizontal, row3], spacing=0)

    def get_board(self):
        return self.board

    # Obtener un ThreeXThree basado en su posición
    def get_threeXthree(self, position):
        return self.threeXthree[position]
    
    # Deshabilitar todos los ThreeXThree
    def disable(self):
        for t in self.threeXthree:
            t.disable()
    
    # Habilitar un ThreeXThree específico
    def unable(self, position):
        self.threeXthree[position].unable()


def main(page: ft.Page):

    page.theme_mode = ft.ThemeMode.DARK
    theme = ft.Theme()
    theme.page_transitions.ios = ft.PageTransitionTheme.NONE
    page.theme = theme

    board = Board(40, 40).get_board()

    page.add(board)

ft.app(target=main, view=ft.WEB_BROWSER)
